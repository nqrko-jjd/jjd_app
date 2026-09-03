/**
 * Parc d'outillage partagé avec Bricoloc.
 * Bricoloc est la source de vérité du parc physique ; JJD sort/rentre les outils
 * sur ses chantiers via l'API partenaire (`/api/partner`, clé `x-api-key`).
 * Dégradation silencieuse : sans `BRICOLOC_API_KEY`, la fonctionnalité est off.
 */
import { env } from '../env.js';
import { HttpError } from './http.js';

export function bricolocEnabled(): boolean {
  return !!env.bricoloc.apiKey;
}

async function call<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  if (!bricolocEnabled()) {
    throw new HttpError(503, 'Parc Bricoloc non configuré (BRICOLOC_API_KEY manquante).');
  }
  const url = new URL(`${env.bricoloc.apiUrl}/api/partner${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'x-api-key': env.bricoloc.apiKey,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new HttpError(502, `Bricoloc injoignable : ${(e as Error).message}`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new HttpError(res.status, data?.error?.message ?? `Bricoloc a répondu ${res.status}`, data);
  }
  return data as T;
}

/* -------------------------------- Chantiers -------------------------------- */

export interface WorksiteLike {
  id: string;
  ref: string;
  title: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  status?: string;
  archived?: boolean;
  client?: { name: string | null } | null;
}

/** Pousse (ou met à jour) un chantier vers Bricoloc. externalRef = worksite.id. */
export async function syncChantier(ws: WorksiteLike): Promise<void> {
  if (!bricolocEnabled()) return;
  const address = [ws.address, [ws.postalCode, ws.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  await call('/chantiers', {
    method: 'POST',
    body: {
      externalRef: ws.id,
      name: `${ws.ref} — ${ws.title}`,
      client: ws.client?.name ?? null,
      address: address || null,
      active: !ws.archived && !['done', 'closed', 'cancelled', 'archived'].includes(ws.status ?? ''),
    },
  });
}

/** Comme syncChantier mais n'échoue jamais (à appeler en fire-and-forget). */
export function syncChantierSafe(ws: WorksiteLike): void {
  syncChantier(ws).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[bricoloc] sync chantier échoué :', (e as Error).message);
  });
}

/* ---------------------------------- Parc ---------------------------------- */

export function getStock(q?: string) {
  return call<{ products: BricolocProduct[] }>('/stock', { query: q ? { q } : {} });
}
export function getConsumables() {
  return call<{ consumables: { id: string; slug: string; name: string; stockQty: number | null }[] }>(
    '/consumables',
  );
}
export function getUnit(code: string) {
  return call<BricolocUnitInfo>(`/units/${encodeURIComponent(code)}`);
}
export function getChantierReport(worksiteId: string) {
  return call<BricolocChantierReport>(`/chantiers/${encodeURIComponent(worksiteId)}`);
}
export function createLoan(body: {
  code: string;
  chantierRef: string;
  takenBy?: string;
  note?: string;
}) {
  return call<{ loan: { id: string; takenAt: string }; unit: { assetTag: string; product: string }; chantier: { name: string; ref: string } }>(
    '/loans',
    { method: 'POST', body },
  );
}
export function returnLoan(body: { code: string; returnedBy?: string; note?: string; toState?: string }) {
  return call<{ loanId: string; unitId: string; state: string }>('/returns', { method: 'POST', body });
}
export function logConsumption(body: {
  code?: string;
  productId?: string;
  quantity: number;
  chantierRef: string;
  takenBy?: string;
  note?: string;
}) {
  return call<{ product: { id: string; name: string }; stockLeft: number }>('/consumption', {
    method: 'POST',
    body,
  });
}

/* --------------------------------- Types --------------------------------- */

export interface BricolocProduct {
  id: string;
  slug: string;
  name: string;
  kind: string;
  category: string | null;
  total: number;
  available: number;
  onSite: number;
  rented: number;
  units: {
    assetTag: string;
    state: string;
    storageLocation: string | null;
    chantier: { name: string; ref: string | null; since: string } | null;
  }[];
}

export interface BricolocUnitInfo {
  unit: { assetTag: string; barcode: string | null; state: string };
  product: { id: string; name: string; kind: string };
  location:
    | { type: 'DEPOT'; storageLocation: string | null }
    | { type: 'CHANTIER'; chantier: { name: string; externalRef: string | null }; since: string; takenBy: string | null }
    | { type: 'RENTED'; reservationNumber: string; until: string }
    | { type: 'MAINTENANCE' | 'DAMAGED' | 'RETIRED' | 'UNKNOWN' };
  history: {
    chantier: string;
    chantierRef: string | null;
    takenAt: string;
    takenBy: string | null;
    returnedAt: string | null;
  }[];
}

export interface BricolocChantierReport {
  chantier: { id: string; externalRef: string | null; name: string };
  tools: { loanId: string; assetTag: string; product: string; since: string; takenBy: string | null }[];
  consumption: { product: string; quantity: number; at: string; takenBy: string | null }[];
}
