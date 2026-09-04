'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, setToken } from './api';

export interface SessionUser {
  id: string;
  email: string;
  role: 'admin' | 'office' | 'foreman' | 'worker' | 'client';
  isPartner: boolean;
  locale: string;
  personId: string | null;
}

export interface SessionPerson {
  id: string;
  displayName: string | null;
  firstName: string;
}

interface Ctx {
  user: SessionUser | null;
  person: SessionPerson | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
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

  return (
    <AuthContext.Provider value={{ user, person, loading, login, logout }}>{children}</AuthContext.Provider>
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
