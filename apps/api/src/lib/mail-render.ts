/**
 * Mise en forme d'un mail pour l'affichage (type Outlook) : HTML nettoyé, images incorporées reprises en place, jamais d'image distante
 * (pixels espions) ni de script. Fonctions pures, sans accès disque ni base.
 */
import sanitizeHtml from 'sanitize-html';

const INLINE_MAX = 1_500_000; // une image incorporée de plus de 1,5 Mo n'est pas reprise dans le corps (elle reste en pièce jointe)

export interface InlinePart { cid: string; contentType: string; content: Buffer }

/** Remplace les `cid:xxx` du HTML par des images incorporées (data:) quand on les a. */
export function inlineCidImages(html: string, parts: InlinePart[]): string {
  const byCid = new Map(parts.filter((p) => /^image\//.test(p.contentType) && p.content.length <= INLINE_MAX).map((p) => [p.cid.replace(/^<|>$/g, ''), p] as const));
  return html.replace(/(["'(\s])cid:([^"'\s)>]+)/gi, (m, pre: string, cid: string) => {
    const p = byCid.get(decodeURIComponent(cid)) ?? byCid.get(cid);
    return p ? `${pre}data:${p.contentType};base64,${p.content.toString('base64')}` : m;
  });
}

const STYLE_OK = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
  'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
  'font-weight': [/^(bold|normal|[1-9]00)$/],
  'font-style': [/^(italic|normal)$/],
  'text-decoration': [/^(underline|none|line-through)$/],
  'text-align': [/^(left|right|center|justify)$/],
  'font-size': [/^[\d.]+(px|pt|em|rem|%)$/],
  'font-family': [/^[\w\s,'"-]+$/],
  width: [/^[\d.]+(px|%)$/], 'max-width': [/^[\d.]+(px|%)$/], height: [/^[\d.]+(px|%)$/],
  'border-collapse': [/^(collapse|separate)$/],
  border: [/^[\w\s#.,()%-]+$/], 'border-bottom': [/^[\w\s#.,()%-]+$/], 'border-top': [/^[\w\s#.,()%-]+$/],
  padding: [/^[\d.\spxem%]+$/], margin: [/^[\d.\spxem%-]+$/],
  'vertical-align': [/^(top|middle|bottom|baseline)$/],
};

/** HTML d'un mail → HTML sûr : balises de mise en page et de texte seulement, liens http(s)/mailto/tel, images incorporées (data:) uniquement. */
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span', 'blockquote', 'pre', 'code', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'font', 'sub', 'sup', 'small', 'center'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], '*': ['style', 'align', 'colspan', 'rowspan', 'valign', 'color', 'size', 'bgcolor', 'width', 'height', 'border', 'cellpadding', 'cellspacing', 'dir'],
    },
    allowedStyles: { '*': STYLE_OK },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: { a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }) },
    // les images distantes (src http) sont retirées par allowedSchemesByTag ; une balise img sans src ne montre rien
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

/** Texte brut lisible d'un mail : le texte du mail, sinon l'HTML aplati. */
export function mailPlainText(text: string | false | undefined | null, html: string | false | undefined | null): string {
  if (text && text.trim()) return text.replace(/\r\n/g, '\n');
  if (html) {
    return sanitizeHtml(String(html), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return '';
}

/** Début lisible du corps (liste de mails) : une ligne, sans citations « > » ni signature de transfert. */
export function mailSnippet(text: string, max = 140): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('>'));
  return lines.join(' ').replace(/\s+/g, ' ').slice(0, max);
}
