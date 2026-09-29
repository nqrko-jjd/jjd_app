import { defineRouting } from 'next-intl/routing';

/**
 * Routing i18n du site vitrine JJD (pas l'app bureau ni le portail, qui restent en français
 * uniquement — hors de l'arborescence [locale]).
 *
 * `localePrefix: 'always'` (donc /fr/..., /en/..., /nl/... — y compris pour le français) plutôt
 * que 'as-needed' : sur ce déploiement, le middleware next-intl (qui gère normalement la
 * réécriture "/" -> "/fr" et la détection de langue) n'est jamais activé par Next au build
 * (cause non identifiée malgré une investigation poussée — non spécifique à next-intl, un
 * middleware trivial sans dépendance échoue pareil). Avec un préfixe toujours présent, la
 * navigation interne (via le composant Link de next-intl) ne dépend plus du tout du middleware
 * — seule la racine nue "/" a besoin d'un repli (voir app/page.tsx).
 */
export const routing = defineRouting({
  locales: ['fr', 'en', 'nl'],
  defaultLocale: 'fr',
  localePrefix: 'always',
  localeCookie: {
    maxAge: 60 * 60 * 24 * 365, // 1 an
  },
});

export type Locale = (typeof routing.locales)[number];
