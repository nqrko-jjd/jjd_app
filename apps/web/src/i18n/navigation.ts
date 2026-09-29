import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Remplaçants localisés de `next/link` et des hooks de navigation — à utiliser dans le site
 * vitrine à la place de `next/link` : les liens portent automatiquement le préfixe de langue
 * courant (aucun effet sur `/app`, `/portail`, en dehors du périmètre `[locale]`).
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
