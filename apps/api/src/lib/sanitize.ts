import sanitizeHtml from 'sanitize-html';

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/;

/**
 * Nettoie le HTML saisi par l'éditeur de texte enrichi des lignes de devis/factures (gras,
 * italique, couleur…) avant stockage — ce contenu est ensuite injecté tel quel dans la page
 * d'impression (dangerouslySetInnerHTML, imprimée en PDF via Puppeteer), donc jamais de balises
 * exécutables (script, on*, style externe…), seulement la mise en forme inline autorisée.
 */
export function sanitizeLineHtml(html: string): string {
  return sanitizeHtml(html, {
    // <font color> : c'est ce que produit réellement execCommand('foreColor') sous Chromium
    // (le moteur de la barre d'outils RichText, voir components/RichText.tsx), pas <span
    // style="color:…"> — les deux sont acceptés pour ne pas dépendre d'un comportement de moteur.
    // <strike> : idem pour execCommand('strikeThrough') — <s> accepté aussi par prudence.
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'span', 'font', 'br', 'ul', 'ol', 'li'],
    allowedAttributes: { span: ['style'], font: ['color'] },
    allowedStyles: {
      span: {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
        'font-size': [/^\d+(\.\d+)?(px|em|rem)$/],
      },
    },
    // sanitize-html ne valide pas la valeur d'un attribut simple (contrairement à allowedStyles) —
    // on rejette nous-mêmes une valeur "color" qui ne ressemble pas à une couleur.
    transformTags: {
      font: (tagName, attribs) => (
        attribs.color && !COLOR_RE.test(attribs.color)
          ? { tagName, attribs: {} }
          : { tagName, attribs }
      ),
    },
    // pas de nesting exotique, pas d'attributs id/class/data-* qui ne servent à rien ici
    disallowedTagsMode: 'discard',
  });
}
