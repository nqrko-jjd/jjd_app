'use client';
import { downloadResponse } from './download';
import { Fragment, createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { isUiLocale, setUiLocale, type UiLocale } from './ui-language';
import { startDomTranslation } from './dom-translate';

const BASE = '/jjd-api/api/portal';
const KEY = 'jjd_portal_token';
const LANG_KEY = 'jjd_portal_locale';

function tok(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setPortalToken(t: string | null) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* */ }
}

export async function portalApi<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = tok();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Erreur ${res.status}`);
  return data as T;
}

/** Upload multipart (ex. photo jointe à une demande d'intervention). */
export async function portalUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const t = tok();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: t ? { authorization: `Bearer ${t}` } : {}, body: form });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Erreur ${res.status}`);
  return data as T;
}

/** PDF authentifié -> URL blob (à ouvrir dans un nouvel onglet). */
export async function portalBlobUrl(path: string): Promise<string> {
  const t = tok();
  const res = await fetch(`${BASE}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

interface Me {
  email: string; label: string; isSyndic: boolean; isPromoter: boolean; access: 'full' | 'limited'; scopeLabel: string | null;
  scope: 'syndic' | 'promoter' | 'building' | 'client';
  locale?: string;
}
interface Ctx { me: Me | null; loading: boolean; signOut: () => void; locale: UiLocale; setLocale: (l: UiLocale) => void }
const PortalContext = createContext<Ctx | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    portalApi<{ user: Me }>('/me').then((r) => setMe(r.user)).catch(() => setMe(null)).finally(() => setLoading(false));
  }, []);

  function signOut() {
    setPortalToken(null);
    setMe(null);
    router.push('/portail');
  }

  // langue : celle du compte une fois connecté, sinon le dernier choix sur cet appareil, sinon la langue du navigateur
  const [pref, setPref] = useState<UiLocale>('fr');
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch { /* */ }
    const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'fr';
    setPref(isUiLocale(saved) ? saved : nav.startsWith('nl') ? 'nl' : nav.startsWith('en') ? 'en' : nav.startsWith('pt') ? 'pt-BR' : 'fr');
  }, []);
  const locale: UiLocale = isUiLocale(me?.locale) ? me.locale : pref;

  function setLocale(l: UiLocale) {
    setPref(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* */ }
    if (me) {
      setMe({ ...me, locale: l });
      portalApi('/me/locale', { method: 'PUT', body: { locale: l } }).catch(() => { /* reste appliquée sur cet appareil */ });
    }
  }

  return (
    <PortalContext.Provider value={{ me, loading, signOut, locale, setLocale }}>
      <PortalLanguage locale={locale} signedIn={!!me}>{children}</PortalLanguage>
    </PortalContext.Provider>
  );
}

const portalTranslator = (body: { locale: UiLocale; strings: string[] }) =>
  portalApi<{ translations: Record<string, string> }>('/translate/ui', { method: 'POST', body });

function PortalLanguage({ locale, signedIn, children }: { locale: UiLocale; signedIn: boolean; children: ReactNode }) {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    setUiLocale(locale);
    document.documentElement.lang = locale;
    setReady(locale);
    return () => { setUiLocale('fr'); document.documentElement.lang = 'fr'; };
  }, [locale]);
  // dictionnaire d'abord, puis traduction à la volée (serveur, en cache) ; avant connexion le serveur refuse et seul le dictionnaire s'applique
  useEffect(() => (ready === locale ? startDomTranslation(locale, portalTranslator) : undefined), [ready, locale, signedIn]);
  if (ready !== locale) return null;
  return <Fragment key={locale}>{children}</Fragment>;
}

export function usePortal() {
  const c = useContext(PortalContext);
  if (!c) throw new Error('usePortal hors PortalProvider');
  return c;
}

export function usePortalGuard() {
  const { me, loading } = usePortal();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !me && !pathname.startsWith('/portail/connexion') && pathname !== '/portail') {
      router.replace('/portail');
    }
  }, [loading, me, pathname, router]);
  return { me, loading };
}

/** Lecture portail avec état (data/error/reload) — même contrat que `useApi` côté bureau. `null` = ne rien charger. */
export function usePortalApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    portalApi<T>(path)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => { setData(null); setError(e instanceof Error ? e.message : 'Erreur'); })
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { reload(); }, [reload]);

  return { data, error, loading, reload };
}

export async function portalDownload(path: string): Promise<void> {
  const t = tok();
  const res = await fetch(`${BASE}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  await downloadResponse(res);
}
