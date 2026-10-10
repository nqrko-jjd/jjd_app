'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, setToken } from './api';

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'office' | 'foreman' | 'worker' | 'storekeeper' | 'client';
  isPartner: boolean;
  entityScope?: string | null;
  locale: string;
  personId: string | null;
}

export interface SessionPerson {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface Ctx {
  user: SessionUser | null;
  person: SessionPerson | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  changeLocale: (locale: string) => Promise<void>;
}

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [person, setPerson] = useState<SessionPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api<{ user: SessionUser; person: SessionPerson | null }>('/api/auth/me')
      .then((r) => { setUser(r.user); setPerson(r.person); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const r = await api<{ token: string; user: SessionUser; person: SessionPerson | null }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setToken(r.token);
    setUser(r.user);
    setPerson(r.person);
    router.push('/app');
  }

  function logout() {
    setToken(null);
    setUser(null);
    setPerson(null);
    router.push('/login');
  }

  async function refresh() {
    const r = await api<{ user: SessionUser; person: SessionPerson | null }>('/api/auth/me');
    setUser(r.user); setPerson(r.person);
  }

  async function changeLocale(locale: string) {
    const r = await api<{ locale: string }>('/api/auth/locale', { method: 'PATCH', body: { locale } });
    setUser(previous => previous ? { ...previous, locale: r.locale } : previous);
  }

  return (
    <AuthContext.Provider value={{ user, person, loading, login, logout, refresh, changeLocale }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth hors AuthProvider');
  return c;
}

/** Redirige vers /login si pas de session (après chargement). */
export function useRequireAuth() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !user && pathname !== '/login') router.replace('/login');
  }, [loading, user, pathname, router]);
  return { user, loading };
}
