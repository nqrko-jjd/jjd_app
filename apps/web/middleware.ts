import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Ne s'applique qu'au site vitrine (accueil + pages sous [locale]) — jamais à l'app bureau
  // (/app), au portail client (/portail), à la connexion, aux PDF imprimés ou aux fiches
  // publiques par lien direct, qui restent en français uniquement, hors de l'arborescence
  // [locale]. `.*\..*` exclut aussi les fichiers statiques (images, favicon...).
  matcher: ['/((?!api|jjd-api|uploads|app|portail|login|fiche|imprimer|rapport|_next|_vercel|.*\\..*).*)'],
};
