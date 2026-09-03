import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_PORT = 4100;

function devLanHost(): string | undefined {
  const raw =
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  const host = raw?.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return undefined;
  return host;
}

const configured = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (devLanHost() ? `http://${devLanHost()}:${API_PORT}` : undefined) ||
  (configured && configured !== 'http://localhost:4100' ? configured : undefined) ||
  'http://localhost:4100';

// eslint-disable-next-line no-console
if (__DEV__) console.log('[JJD] API_URL =', API_URL);

const TOKEN_KEY = 'jjd_token';
const QUEUE_KEY = 'jjd_offline_queue';

let memToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  memToken = await AsyncStorage.getItem(TOKEN_KEY);
  return memToken;
}
export async function setToken(t: string | null): Promise<void> {
  memToken = t;
  if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface QueuedCall {
  id: string;
  path: string;
  method: string;
  body: unknown;
  at: number;
}

async function readQueue(): Promise<QueuedCall[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedCall[]) : [];
}
async function writeQueue(q: QueuedCall[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

async function raw<T>(path: string, method: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
  return data as T;
}

/** GET simple — pas de file d'attente (échoue franchement hors ligne). */
export function apiGet<T>(path: string): Promise<T> {
  return raw<T>(path, 'GET');
}

/**
 * POST/PATCH. Si le réseau échoue, la requête est mise en file et rejouée
 * plus tard. `queueable` est faux pour ce qui doit répondre tout de suite
 * (ex. connexion).
 */
export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  queueable = true,
): Promise<T | { queued: true }> {
  try {
    const r = await raw<T>(path, method, body);
    void flushQueue();
    return r;
  } catch (e) {
    const offline = e instanceof TypeError; // fetch a échoué (pas de réseau)
    if (offline && queueable) {
      const q = await readQueue();
      q.push({ id: `${Date.now()}-${Math.random()}`, path, method, body, at: Date.now() });
      await writeQueue(q);
      return { queued: true };
    }
    throw e;
  }
}

let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let done = 0;
  try {
    let q = await readQueue();
    while (q.length) {
      const item = q[0]!;
      try {
        await raw(item.path, item.method, item.body);
      } catch (e) {
        if (e instanceof TypeError) break; // toujours hors ligne
        // erreur serveur définitive -> on abandonne cette entrée
      }
      q = q.slice(1);
      await writeQueue(q);
      done++;
    }
  } finally {
    flushing = false;
  }
  return done;
}
