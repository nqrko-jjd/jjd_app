import { downloadResponse } from './download';
const BASE = '/jjd-api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function token(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('jjd_token');
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem('jjd_token', t);
    else localStorage.removeItem('jjd_token');
  } catch {
    /* mode privé */
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data);
  }
  return data as T;
}

/** Récupère un binaire authentifié (PDF…) et renvoie une URL blob à ouvrir. */
export async function apiBlobUrl(path: string, opts: { method?: string; body?: unknown } = {}): Promise<string> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { headers, method: opts.method ?? 'GET', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}

/** Upload multipart (photos du fil de chantier). */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`, data);
  return data as T;
}

/** Download a PDF with the reference supplied by the server. */
export async function apiDownload(path: string): Promise<void> {
  const t = token();
  const res = await fetch(`${BASE}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
  }
  await downloadResponse(res);
}
