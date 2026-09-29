import { defineRouting } from 'next-intl/routing';

/**
 * Routing i18n du site vitrine JJD (pas l'app bureau ni le portail, qui restent en français
 * uniquement — voir le middleware pour le périmètre exact).
 * Le français est la langue source et reste à la racine (`/`), l'anglais et le néerlandais
 * sont préfixés (`/en/...`, `/nl/...`).
 */
export const routing = defineRouting({
  locales: ['fr', 'en', 'nl'],
  defaultLocale: 'fr',
  localePrefix: 'as-needed',
  localeCookie: {
    maxAge: 60 * 60 * 24 * 365, // 1 an
  },
});

export type Locale = (typeof routing.locales)[number];
