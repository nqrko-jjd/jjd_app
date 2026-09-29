'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Apparition douce au scroll pour les blocs du site vitrine.
 * Monté une fois dans le layout ; re-scanne à chaque changement de page.
 * Respecte prefers-reduced-motion.
 */
const SELECTOR = [
  '.site .s-head',
  '.site .s-split',
  '.site .s-steps',
  '.site .s-cta',
  '.site .s-panel',
  '.site .s-list',
  '.site .s-grid > *',
  '.site .s-hero-inner > *',
  '.site .s-fig',
  '.site [data-reveal]',
].join(',');

export function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    if (!els.length) return;

    const revealAll = () => els.forEach((e) => e.classList.add('is-in'));

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Pas d'IntersectionObserver, ou page non visible (aperçu, capture) -> tout afficher.
    if (reduce || typeof IntersectionObserver === 'undefined' || document.visibilityState !== 'visible') {
      revealAll();
      return;
    }

    // léger décalage en cascade pour les enfants de grilles
    document.querySelectorAll<HTMLElement>('.site .s-grid').forEach((grid) => {
      Array.from(grid.children).forEach((c, i) => {
        (c as HTMLElement).style.setProperty('--reveal-delay', `${Math.min(i, 6) * 65}ms`);
      });
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('is-in');
            io.unobserve(en.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );

    const vh = window.innerHeight;
    els.forEach((e) => {
      if (e.classList.contains('is-in')) return;
      const r = e.getBoundingClientRect();
      // déjà visible au chargement -> pas d'effet (évite le flash au-dessus de la ligne de flottaison)
      if (r.top < vh * 0.92 && r.bottom > 0) {
        e.classList.add('is-in');
      } else {
        e.classList.add('reveal');
        io.observe(e);
      }
    });

    // filet de sécurité : au scroll, on révèle aussi « à la main » (au cas où l'observer flanche).
    const onScroll = () => {
      let remaining = false;
      const h = window.innerHeight;
      for (const e of els) {
        if (e.classList.contains('is-in')) continue;
        const r = e.getBoundingClientRect();
        if (r.top < h * 0.92 && r.bottom > 0) e.classList.add('is-in');
        else remaining = true;
      }
      if (!remaining) window.removeEventListener('scroll', onScroll);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, [pathname]);

  return null;
}
