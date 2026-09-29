import { redirect } from 'next/navigation';

/**
 * Racine nue ("/", hors de [locale]) — sans middleware actif pour la réécrire, ce repli
 * explicite envoie vers la langue par défaut. Voir i18n/routing.ts pour le contexte complet.
 */
export default function RootPage() {
  redirect('/fr');
}
