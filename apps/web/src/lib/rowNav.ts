import type { MouseEvent } from 'react';

/**
 * onClick pour rendre toute une ligne de tableau cliquable (navigue vers `href`),
 * sans casser les liens / boutons internes ni la sélection de texte.
 * Ajouter la classe `row-link` à la <tr> pour le curseur.
 */
export function rowNav(href: string, go: (href: string) => void) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return;
    go(href);
  };
}
