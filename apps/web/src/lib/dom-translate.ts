/**
 * Filet de sécurité de la traduction de l'interface : tout texte français affiché qui n'est pas dans les dictionnaires (ui-dict, tr())
 * est traduit à la volée par le serveur (DeepL, mis en cache une fois pour toutes) puis remplacé dans la page.
 * Actif seulement quand la langue du compte n'est pas le français. Les messages de discussion (déjà traduits côté serveur),
 * les champs de saisie et tout élément `translate="no"` sont laissés tels quels.
 */
import { api } from './api';
import { translateUi, type UiLocale } from './ui-language';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SVG', 'NOSCRIPT', 'OPTION']);
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const MAX_LEN = 200;
const MAX_BATCH = 60;

export function startDomTranslation(locale: UiLocale): () => void {
  if (locale === 'fr' || typeof document === 'undefined') return () => {};
  const storeKey = `uitr:${locale}`;
  let cache: Record<string, string> = {};
  try { cache = JSON.parse(localStorage.getItem(storeKey) ?? '{}'); } catch { /* sans cache local */ }
  const saveCache = () => { try { localStorage.setItem(storeKey, JSON.stringify(cache)); } catch { /* quota */ } };
  const failed = new Set<string>();
  const pending = new Map<string, Set<() => void>>(); // texte français → remplacements à appliquer à l'arrivée
  const nodeOrig = new WeakMap<Node, string>(); // nœud texte → texte français d'origine
  const nodeDone = new WeakMap<Node, string>(); // nœud texte → valeur que NOUS venons d'y poser (pour ne pas la retraduire)
  const attrOrig = new WeakMap<Element, Record<string, string>>();
  const attrDone = new WeakMap<Element, Record<string, string>>();
  const touchedNodes = new Set<WeakRef<Node>>();
  const touchedAttrs = new Set<WeakRef<Element>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const translatable = (t: string) => t.length >= 2 && t.length <= MAX_LEN && /\p{L}{2}/u.test(t) && !/[@]|https?:|^[\p{L}\d._-]+\/[\p{L}\d/._-]*$/u.test(t) && !/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(t) && !/\d{3,}/.test(t);
  const skipEl = (el: Element | null): boolean => {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName.toUpperCase()) || e.getAttribute('translate') === 'no' || e.classList.contains('msg-bubble') || (e as HTMLElement).isContentEditable) return true;
    }
    return false;
  };

  function flush() {
    timer = null;
    const texts = [...pending.keys()].slice(0, MAX_BATCH);
    if (!texts.length) return;
    api<{ translations: Record<string, string> }>('/api/translate/ui', { method: 'POST', body: { locale, strings: texts } })
      .then((r) => {
        for (const t of texts) {
          const done = r.translations[t];
          if (done && done !== t) cache[t] = done; else failed.add(t);
          const apply = pending.get(t); pending.delete(t);
          if (!stopped && done && done !== t) apply?.forEach((fn) => fn());
        }
        saveCache();
      })
      .catch(() => { for (const t of texts) { pending.delete(t); failed.add(t); } })
      .finally(() => { if (pending.size && !stopped) timer = setTimeout(flush, 100); });
  }
  function request(text: string, apply: () => void) {
    if (failed.has(text)) return;
    const set = pending.get(text) ?? new Set();
    set.add(apply); pending.set(text, set);
    timer ??= setTimeout(flush, 150);
  }

  function visitText(node: Text) {
    if (skipEl(node.parentElement)) return;
    const value = node.nodeValue ?? '';
    if (nodeDone.get(node) === value) return; // posé par nous : ne pas retraduire
    const lead = /^\s*/.exec(value)![0], trail = /\s*$/.exec(value)![0];
    const text = value.trim();
    if (!translatable(text)) return;
    const hit = translateUi(text, locale);
    const put = (t: string) => { const next = lead + t + trail; if (!nodeOrig.has(node)) nodeOrig.set(node, value); nodeDone.set(node, next); node.nodeValue = next; touchedNodes.add(new WeakRef(node)); };
    if (hit !== text) { put(hit); return; }
    if (cache[text]) { put(cache[text]); return; }
    request(text, () => { if (node.nodeValue === value && cache[text]) put(cache[text]); });
  }
  function visitAttrs(el: Element) {
    if (skipEl(el)) return;
    for (const a of ATTRS) {
      const value = el.getAttribute(a);
      if (!value) continue;
      if (attrDone.get(el)?.[a] === value) continue;
      const text = value.trim();
      if (!translatable(text)) continue;
      const put = (t: string) => { const o = attrOrig.get(el) ?? {}; if (o[a] === undefined) attrOrig.set(el, { ...o, [a]: value }); attrDone.set(el, { ...(attrDone.get(el) ?? {}), [a]: t }); el.setAttribute(a, t); touchedAttrs.add(new WeakRef(el)); };
      const hit = translateUi(text, locale);
      if (hit !== text) put(hit);
      else if (cache[text]) put(cache[text]);
      else request(text, () => { if (el.getAttribute(a) === value && cache[text]) put(cache[text]); });
    }
  }
  function visit(root: Node) {
    if (root.nodeType === Node.TEXT_NODE) { visitText(root as Text); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as Element;
    if (skipEl(el)) return;
    visitAttrs(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) visitText(n as Text); else visitAttrs(n as Element);
    }
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') visit(r.target);
      else if (r.type === 'attributes') visitAttrs(r.target as Element);
      else r.addedNodes.forEach(visit);
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  visit(document.body);

  return () => {
    stopped = true; mo.disconnect(); if (timer) clearTimeout(timer);
    for (const ref of touchedNodes) { const n = ref.deref(); const o = n && nodeOrig.get(n); if (n && o !== undefined && n.isConnected) n.nodeValue = o; }
    for (const ref of touchedAttrs) { const e = ref.deref(); const o = e && attrOrig.get(e); if (e && o) for (const [a, v] of Object.entries(o)) e.setAttribute(a, v); }
  };
}
