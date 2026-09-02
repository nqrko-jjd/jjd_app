/**
 * Trois langues : FR (source, jamais auto-traduite), NL et EN (DeepL).
 * Même approche que le projet Bricoloc. Le terrain (ouvriers lusophones /
 * hispanophones) utilise l'UI traduite ; la donnée métier reste en FR.
 */

export const LOCALES = ['fr', 'nl', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const SOURCE_LOCALE: Locale = 'fr';
export const AUTO_TRANSLATE_TARGETS: Locale[] = ['nl', 'en'];

export const LOCALE_META: Record<Locale, { label: string; flag: string; intl: string }> = {
  fr: { label: 'Français', flag: '🇫🇷', intl: 'fr-BE' },
  nl: { label: 'Nederlands', flag: '🇧🇪', intl: 'nl-BE' },
  en: { label: 'English', flag: '🇬🇧', intl: 'en-GB' },
};

/** Bloc de texte multilingue stocké en Json ({ fr, nl?, en? }). */
export type I18nText = { fr: string } & Partial<Record<Locale, string>>;

export function pickText(t: I18nText | null | undefined, locale: Locale): string {
  if (!t) return '';
  return t[locale] ?? t[SOURCE_LOCALE] ?? '';
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
