'use client';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { isUiLocale, setUiLocale } from '@/lib/ui-language';
import { startDomTranslation } from '@/lib/dom-translate';

export function AppLanguage({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const locale = isUiLocale(user?.locale) ? user.locale : 'fr';
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    setUiLocale(locale);
    document.documentElement.lang = locale;
    setReady(locale);
    return () => { setUiLocale('fr'); document.documentElement.lang = 'fr'; };
  }, [locale]);
  // filet de sécurité : tout texte français hors dictionnaire est traduit à la volée (DeepL, en cache)
  useEffect(() => (ready === locale ? startDomTranslation(locale) : undefined), [ready, locale]);
  if (ready !== locale) return null;
  return <Fragment key={locale}>{children}</Fragment>;
}
