import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiGet, apiSend, setToken, getToken, storageKey } from './api';

interface User {
  id: string;
  email: string;
  role: string;
  personId: string | null;
  entityScope?: string | null;
  locale?: string;
  /** Espace client : nom affiché, étendue (client / syndic…) et niveau d'accès. */
  label?: string;
  scopeLabel?: string | null;
  access?: string;
}
interface PortalMe {
  user: { email: string; label: string; access?: string; scopeLabel?: string | null };
}
const PORTAL_FLAG = 'jjd_portal';
const portalUser = (m: PortalMe['user']): User => ({
  id: `portal:${m.email}`, email: m.email, role: 'client', personId: null,
  label: m.label, scopeLabel: m.scopeLabel ?? null, access: m.access,
});
interface Person {
  id: string;
  firstName: string;
  displayName: string | null;
}

interface Ctx {
  user: User | null;
  person: Person | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Connexion de l'espace client : le jeton portail vient de /api/portal/login ou /verify-code. */
  signInPortal: (token: string) => Promise<void>;
}

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const t = await getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    const cacheKey = storageKey('jjd_session_cache');
    const portal = await AsyncStorage.getItem(storageKey(PORTAL_FLAG)) === '1';
    try {
      const r = portal
        ? await apiGet<PortalMe>('/api/portal/me').then((m) => ({ user: portalUser(m.user), person: null as Person | null }))
        : await apiGet<{ user: User; person: Person | null }>('/api/auth/me');
      if (await getToken() !== t) return;
      await setToken(t, r.user.id);
      setUser(r.user);
      setPerson(r.person);
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ token: t, ...r }));
    } catch (e) {
      if (await getToken() !== t) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await setToken(null);
        await AsyncStorage.removeItem(cacheKey);
        await AsyncStorage.removeItem(storageKey(PORTAL_FLAG));
        setUser(null); setPerson(null);
      } else {
        const cached = JSON.parse(await AsyncStorage.getItem(cacheKey) ?? 'null');
        if (cached?.token === t) { setUser(cached.user); setPerson(cached.person); }
        else throw e;
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load().catch(() => { /* Login stays available if there is no usable offline session. */ });
  }, []);

  async function signIn(email: string, password: string) {
    const r = (await apiSend<{ token: string; user: User }>(
      '/api/auth/login',
      'POST',
      { email, password },
      false,
    )) as { token: string; user: User };
    await AsyncStorage.removeItem(storageKey(PORTAL_FLAG));
    await setToken(r.token, r.user.id);
    await load();
  }

  async function signInPortal(token: string) {
    await AsyncStorage.setItem(storageKey(PORTAL_FLAG), '1');
    await setToken(token, 'portal');
    await load();
  }

  async function signOut() {
    await setToken(null);
    await AsyncStorage.removeItem(storageKey(PORTAL_FLAG));
    await AsyncStorage.removeItem(storageKey('jjd_session_cache'));
    setUser(null);
    setPerson(null);
  }

  return (
    <SessionContext.Provider value={{ user, person, loading, signIn, signOut, signInPortal }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession hors SessionProvider');
  return c;
}
