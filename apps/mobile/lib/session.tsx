import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiSend, setToken, getToken } from './api';

interface User {
  id: string;
  email: string;
  role: string;
  personId: string | null;
}
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
    try {
      const r = await apiGet<{ user: User; person: Person | null }>('/api/auth/me');
      setUser(r.user);
      setPerson(r.person);
    } catch {
      await setToken(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function signIn(email: string, password: string) {
    const r = (await apiSend<{ token: string; user: User }>(
      '/api/auth/login',
      'POST',
      { email, password },
      false,
    )) as { token: string; user: User };
    await setToken(r.token);
    await load();
  }

  async function signOut() {
    await setToken(null);
    setUser(null);
    setPerson(null);
  }

  return (
    <SessionContext.Provider value={{ user, person, loading, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession hors SessionProvider');
  return c;
}
