import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function SiteFooter() {
  const t = useTranslations('footer');
  const nav = useTranslations('nav');
  return (
    <footer className="s-footer">
      <div className="s-wrap">
        <div className="s-footer-grid">
          <div>
            <div className="s-brand"><b>JJD</b> <span>Consult</span></div>
            <p>{t('tagline')}<br />{t('location')}</p>
          </div>
          <div>
            <h5>{t('navTitle')}</h5>
            <Link href="/maintenance">{nav('maintenance')}</Link>
            <Link href="/renovation">{nav('renovation')}</Link>
            <Link href="/projets">{nav('projets')}</Link>
            <Link href="/realisations">{t('realisations')}</Link>
            <Link href="/a-propos">{nav('aPropos')}</Link>
          </div>
          <div>
            <h5>{t('contactTitle')}</h5>
            <a href="mailto:info@jjd-consult.be">info@jjd-consult.be</a>
            <a href="tel:+3228879239">+32 2 887 92 39</a>
            <span style={{ display: 'block', padding: '0.2rem 0' }}>Gieterijstraat 49, 1601 Leeuw-Saint-Pierre</span>
            {/* /app et /portail sont hors du périmètre [locale] (toujours en français) — lien
                classique, jamais préfixé par la langue courante. */}
            <a href="/app">{t('espaceEquipe')}</a>
            <a href="/portail">{t('espaceClient')}</a>
          </div>
        </div>
        <div className="s-footer-base">
          <span>© {new Date().getFullYear()} JJD Consult. {t('rights')}</span>
          <span>{t('vatLine')}</span>
        </div>
      </div>
    </footer>
  );
}
