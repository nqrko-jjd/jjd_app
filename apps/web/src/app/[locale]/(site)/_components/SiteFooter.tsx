import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="s-footer">
      <div className="s-wrap">
        <div className="s-footer-grid">
          <div>
            <div className="s-brand"><b>JJD</b> <span>Consult</span></div>
            <p>Maintenance • Rénovation • Projets<br />Bruxelles et Brabant wallon</p>
          </div>
          <div>
            <h5>Naviguer</h5>
            <Link href="/maintenance">Maintenance</Link>
            <Link href="/renovation">Rénovation</Link>
            <Link href="/projets">Projets</Link>
            <Link href="/realisations">Nos réalisations</Link>
            <Link href="/a-propos">Qui sommes-nous ?</Link>
          </div>
          <div>
            <h5>Contact</h5>
            <a href="mailto:info@jjd-consult.be">info@jjd-consult.be</a>
            <a href="tel:+3228879239">+32 2 887 92 39</a>
            <span style={{ display: 'block', padding: '0.2rem 0' }}>Gieterijstraat 49, 1601 Leeuw-Saint-Pierre</span>
            <Link href="/app">Espace équipe</Link>
            <Link href="/portail">Espace client</Link>
          </div>
        </div>
        <div className="s-footer-base">
          <span>© {new Date().getFullYear()} JJD Consult. Tous droits réservés.</span>
          <span>TVA BE — Bruxelles &amp; Brabant wallon</span>
        </div>
      </div>
    </footer>
  );
}
