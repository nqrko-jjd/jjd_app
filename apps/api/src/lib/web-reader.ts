/**
 * Accès web des agents (connecteur Claude) : recherche (DuckDuckGo, sans clé) et lecture d'une page publique en texte.
 * Lecture seule. Garde-fous : http(s) uniquement, ports 80/443, aucune adresse privée ou locale (y compris après
 * redirection), 15 s maximum, 3 Mo maximum, 5 redirections au plus.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sanitizeHtml from 'sanitize-html';

const UA = 'Mozilla/5.0 (compatible; JJD-QG/1.0; +https://new.jjd-consult.be)';
const MAX_BYTES = 3_000_000;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return m ? isPrivateAddress(m[1]!) : false;
  }
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Adresse web invalide.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Seules les adresses http(s) sont permises.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Port non autorisé.');
  if (u.username || u.password) throw new Error('Adresse avec identifiants refusée.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Adresse locale refusée.');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Adresse privée ou locale refusée.');
  return u;
}

async function fetchPublic(raw: string): Promise<{ url: string; status: number; type: string; body: string }> {
  let url = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop < 6; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': UA, 'accept-language': 'fr-BE,fr;q=0.9,nl;q=0.6,en;q=0.5', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = (await assertPublicUrl(new URL(r.headers.get('location')!, url).toString())).toString(); continue; }
      const reader = r.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); break; } chunks.push(value); }
      return { url, status: r.status, type: r.headers.get('content-type') ?? '', body: Buffer.concat(chunks).toString('utf8') };
    } finally { clearTimeout(t); }
  }
  throw new Error('Trop de redirections.');
}

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** HTML → texte lisible : titres, paragraphes et listes gardés, menus/scripts/styles retirés, liens conservés en fin. */
export function htmlToReadable(html: string, base: string): { titre: string; description: string; texte: string; liens: { texte: string; url: string }[] } {
  const titre = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim()).slice(0, 200);
  const description = decode(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ?? '').slice(0, 400);
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  const cleaned = main.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const withBreaks = cleaned.replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<h([1-6])[^>]*>/gi, '\n## ');
  const texte = decode(sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const liens: { texte: string; url: string }[] = []; const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string; try { href = new URL(decode(m[1]!), base).toString(); } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    const txt = decode(sanitizeHtml(m[2] ?? '', { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, ' ').trim();
    if (!txt) continue; seen.add(href); liens.push({ texte: txt.slice(0, 80), url: href });
    if (liens.length >= 40) break;
  }
  return { titre, description, texte, liens };
}

export async function readWebPage(url: string, maxChars = 12000) {
  const r = await fetchPublic(url);
  if (r.status >= 400) return { url: r.url, statut: r.status, erreur: `La page répond ${r.status}.` };
  if (/application\/pdf/i.test(r.type)) return { url: r.url, statut: r.status, erreur: 'C’est un PDF : son texte n’est pas lu ici.' };
  if (!/html|text|xml|json/i.test(r.type)) return { url: r.url, statut: r.status, erreur: `Type de contenu non lu : ${r.type || 'inconnu'}.` };
  const p = /html/i.test(r.type) ? htmlToReadable(r.body, r.url) : { titre: '', description: '', texte: r.body, liens: [] };
  const jsOnly = p.texte.length < 200;
  return { url: r.url, statut: r.status, titre: p.titre, description: p.description, texte: p.texte.slice(0, maxChars), tronque: p.texte.length > maxChars, liens: p.liens.slice(0, 25),
    ...(jsOnly ? { note: 'Presque pas de texte : la page se construit sans doute en JavaScript (Instagram, Facebook, LinkedIn…). Utilise le navigateur de l’app Claude si disponible.' } : {}) };
}

/** Recherche web via la version HTML de DuckDuckGo (sans clé), résultats belges en français en priorité. */
export async function webSearch(query: string, limit = 8) {
  const r = await fetchPublic(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=be-fr`);
  const out: { titre: string; url: string; extrait: string }[] = [];
  const blocks = r.body.split(/<div[^>]+class="[^"]*result[ _]/i).slice(1);
  for (const b of blocks) {
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    let href = decode(a[1]!);
    const uddg = /[?&]uddg=([^&]+)/.exec(href); if (uddg) href = decodeURIComponent(uddg[1]!);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const snip = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(b)?.[1] ?? '';
    const clean = (s: string) => decode(sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, ' ').trim();
    out.push({ titre: clean(a[2] ?? '').slice(0, 160), url: href, extrait: clean(snip).slice(0, 300) });
    if (out.length >= limit) break;
  }
  return { requete: query, nombre: out.length, resultats: out, ...(out.length ? {} : { note: 'Aucun résultat lu (le moteur a peut-être limité la requête). Reformule ou réessaie dans un moment.' }) };
}
