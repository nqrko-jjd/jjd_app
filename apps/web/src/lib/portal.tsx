'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const BASE = '/jjd-api/api/portal';
const KEY = 'jjd_portal_token';

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

/** PDF authentifié -> URL blob (à ouvrir dans un nouvel onglet). */
export async function portalBlobUrl(path: string): Promise<string> {
  const t = tok();
  const res = await fetch(`${BASE}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

interface Me { email: string; label: string; isSyndic: boolean; access: 'full' | 'limited'; scopeLabel: string | null }
interface Ctx { me: Me | null; loading: boolean; signOut: () => void }
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

  return <PortalContext.Provider value={{ me, loading, signOut }}>{children}</PortalContext.Provider>;
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
