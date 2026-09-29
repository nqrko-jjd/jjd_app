import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import { routing } from '@/i18n/routing';

// Pas de generateStaticParams ici : sur ce déploiement, la génération statique par langue
// partageait la résolution de locale entre les 3 routes prérendues (toutes rendaient les
// messages FR, y compris /en et /nl) — probablement un souci d'isolation du cache de requête
// React entre workers de build. Rendu dynamique par requête à la place : chaque page relit
// explicitement `params.locale`, pas d'ambiguïté possible.
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
