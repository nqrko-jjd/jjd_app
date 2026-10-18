import { File } from 'expo-file-system';
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

const TEAM_API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (devLanHost() ? `http://${devLanHost()}:${API_PORT}` : undefined) ||
  (configured && configured !== 'http://localhost:4100' ? configured : undefined) ||
  'http://localhost:4100';

export let API_URL = TEAM_API_URL;
const DEMO_API_URL = 'https://new.jjd-consult.be/jjd-demo-api';
let demo = false;
let environmentReady: Promise<void> | undefined;
export function isDemoEnvironment() { return demo; }
export function storageKey(key: string) { return demo ? `demo:${key}` : key; }
export function initializeEnvironment() {
  return environmentReady ??= AsyncStorage.getItem('jjd_environment').then(value => {
    demo = value === 'demo';
    API_URL = demo ? DEMO_API_URL : TEAM_API_URL;
  });
}
/** Available only while signed out. Wait for offline replay before changing its storage. */
export async function selectEnvironment(useDemo: boolean) {
  await initializeEnvironment();
  if (await getToken()) throw new Error('Déconnectez-vous avant de changer d’espace.');
  await serialized(async () => {
    if (await getToken()) throw new Error('Déconnectez-vous avant de changer d’espace.');
    await AsyncStorage.setItem('jjd_environment', useDemo ? 'demo' : 'team');
    demo = useDemo;
    API_URL = demo ? DEMO_API_URL : TEAM_API_URL;
    memToken = null;
    // Never silently restore another space's account on the login screen.
    await AsyncStorage.removeItem(storageKey(TOKEN_KEY));
    await AsyncStorage.removeItem(storageKey(OWNER_KEY));
    await AsyncStorage.removeItem(storageKey('jjd_session_cache'));
  });
}

// eslint-disable-next-line no-console
if (__DEV__) console.log('[JJD] API_URL =', API_URL);

const TOKEN_KEY = 'jjd_token';
const QUEUE_KEY = 'jjd_offline_queue';
const OWNER_KEY = 'jjd_token_owner';

let memToken: string | null = null;

export async function getToken(): Promise<string | null> {
  await initializeEnvironment();
  if (memToken) return memToken;
  memToken = await AsyncStorage.getItem(storageKey(TOKEN_KEY));
  return memToken;
}
export async function setToken(t: string | null, userId?: string): Promise<void> {
  await initializeEnvironment();
  await AsyncStorage.setItem(storageKey(OWNER_KEY), JSON.stringify({ token: t, userId: userId ?? null }));
  memToken = t;
  if (t) await AsyncStorage.setItem(storageKey(TOKEN_KEY), t);
  else await AsyncStorage.removeItem(storageKey(TOKEN_KEY));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface QueuedCall {
  ownerId?: string;
  error?: string;
  id: string;
  path: string;
  method: string;
  body: unknown;
  at: number;
}

async function readQueue(): Promise<QueuedCall[]> {
  const raw = await AsyncStorage.getItem(storageKey(QUEUE_KEY));
  return raw ? (JSON.parse(raw) as QueuedCall[]) : [];
}
async function writeQueue(q: QueuedCall[]): Promise<void> {
  await AsyncStorage.setItem(storageKey(QUEUE_KEY), JSON.stringify(q));
}

// All queue mutations are serialized, including replay and new actions.
let tail: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.catch(() => undefined);
  return result;
}
async function identity() {
  const token = await getToken();
  const saved = JSON.parse(await AsyncStorage.getItem(storageKey(OWNER_KEY)) ?? 'null');
  return { token, ownerId: token && saved?.token === token ? saved.userId as string | null : null };
}
export async function pendingCalls(): Promise<QueuedCall[]> {
  const { ownerId } = await identity();
  return ownerId ? (await readQueue()).filter(q => q.ownerId === ownerId) : [];
}
export async function pendingCount(): Promise<number> { return (await pendingCalls()).length; }
export async function queueStatus() {
  const calls = await pendingCalls();
  return { count: calls.length, error: calls.find(q => q.error)?.error,
    legacyCount: (await readQueue()).filter(q => !q.ownerId).length };
}

async function raw<T>(path: string, method: string, body?: unknown, token?: string | null): Promise<T> {
  if (token === undefined) token = await getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method, signal: controller.signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch {
      throw new ApiError(res.status, 'Réponse du serveur illisible. Action conservée pour vérification.');
    }
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
    return data as T;
  } finally { clearTimeout(timeout); }
}

/** GET simple — pas de file d'attente (échoue franchement hors ligne). */
export function apiGet<T>(path: string): Promise<T> {
  return raw<T>(path, 'GET');
}

/** Upload d'une photo (fil de chantier). `uri` = fichier local Expo. */
export async function apiUploadPhoto<T = unknown>(
  path: string,
  uri: string,
  caption?: string,
): Promise<T> {
  const token = await getToken();
  const form = new FormData();
  form.append('file', new File(uri));
  if (caption) form.append('caption', caption);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
  return data as T;
}

/** Persist before sending: a crash or lost response must never erase an action. */
export async function apiSend<T>(
  path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, queueable = true,
): Promise<T | { queued: true }> {
  const session = await identity();
  if (!queueable) return raw<T>(path, method, body, session.token);
  if (!session.ownerId) throw new ApiError(401, 'Reconnecte-toi pour enregistrer cette action.');
  return serialized(async () => {
    if ((await identity()).token !== session.token) throw new ApiError(401, 'Le compte a changé.');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = path === '/api/timesheet/timer/start' || path === '/api/timesheet/timer/stop';
    const item: QueuedCall = { id, path, method, body: timer ? { ...(body as object), operationId: id } : body,
      ownerId: session.ownerId!, at: Date.now() };
    const q = await readQueue();
    q.push(item);
    await writeQueue(q);
    const result = await drain(session, id);
    return result.delivered ? result.value as T : { queued: true };
  });
}

async function drain(session: { token: string | null; ownerId: string | null }, target?: string) {
  let done = 0;
  let delivered = false;
  let value: unknown;
  if (!session.ownerId) return { done, delivered, value };
  for (;;) {
    if ((await identity()).token !== session.token) break;
    const q = await readQueue();
    // Unowned legacy entries are retained, never attributed to the next login.
    const item = q.find(q => q.ownerId === session.ownerId);
    if (!item) break;
    try {
      const response = await raw(item.path, item.method, item.body, session.token);
      await writeQueue(q.filter(q => q.id !== item.id));
      done++;
      if (item.id === target) { delivered = true; value = response; }
    } catch (e) {
      // A newly submitted, explicitly rejected action must still show the form
      // error. Older/ambiguous attempts stay durable for recovery and review.
      if (item.id === target && e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.status)) {
        await writeQueue(q.filter(q => q.id !== item.id));
        throw e;
      }
      item.error = e instanceof ApiError ? e.message : 'Connexion indisponible. Réessaie la synchronisation.';
      await writeQueue(q);
      break; // Preserve every failure, and preserve chronological order.
    }
  }
  return { done, delivered, value };
}

export async function flushQueue(): Promise<number> {
  const session = await identity();
  return serialized(async () => (await drain(session)).done);
}
