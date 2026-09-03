/**
 * Ponto Connect (Ibanity) — agrégation bancaire PSD2.
 *
 * Dégradation silencieuse : sans certificats / client_id, `pontoConfigured()`
 * renvoie false et l'app fonctionne sans connexion bancaire.
 *
 * Mise en service : voir docs/ponto.md. En résumé côté David :
 *   1. créer une intégration sur https://myponto.com (ou dashboard Ibanity)
 *   2. télécharger le certificat mTLS + la clé privée -> apps/api/secrets/
 *   3. régler PONTO_CLIENT_ID / PONTO_REDIRECT_URI dans apps/api/.env
 *   4. l'URL de callback doit être publique -> après déploiement Combell
 *
 * ⚠️ Les chemins d'endpoints et le schéma de signature sont à revalider avec
 * la doc Ibanity au moment de l'activation (marqués « TODO(ibanity) »).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../db.js';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

const API_BASE = env.ponto.sandbox
  ? 'https://api.ibanity.com/ponto-connect' // sandbox partage l'hôte, credentials distincts
  : 'https://api.ibanity.com/ponto-connect';
const AUTH_BASE = 'https://authorization.ibanity.com/ponto-connect'; // TODO(ibanity) confirmer (sandbox ?)
const SCOPES = 'ai name offline_access';

const secretPath = (p: string) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));

/** Requête HTTPS avec certificat client (mTLS) — `fetch` global ne gère pas le cert client. */
function httpsRequest(
  urlStr: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        method: opts.method ?? 'GET',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: opts.headers,
        agent: mtlsAgent() ?? undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

let agent: https.Agent | null = null;
let agentChecked = false;

export function pontoConfigured(): boolean {
  return (
    !!env.ponto.clientId &&
    existsSync(secretPath(env.ponto.certFile)) &&
    existsSync(secretPath(env.ponto.keyFile))
  );
}

function mtlsAgent(): https.Agent | null {
  if (agentChecked) return agent;
  agentChecked = true;
  if (!pontoConfigured()) {
    console.log('[ponto] non configuré (client_id ou certificats manquants) — connexion bancaire désactivée');
    return null;
  }
  try {
    agent = new https.Agent({
      cert: readFileSync(secretPath(env.ponto.certFile)),
      key: readFileSync(secretPath(env.ponto.keyFile)),
      passphrase: env.ponto.keyPassphrase || undefined,
      keepAlive: true,
    });
    console.log('[ponto] actif (mTLS)');
  } catch (e) {
    console.error('[ponto] certificats illisibles :', (e as Error).message);
    agent = null;
  }
  return agent;
}

/* ------------------------------------------------------------------ tokens */

interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
}

async function readTokens(): Promise<TokenSet | null> {
  const row = await prisma.setting.findUnique({ where: { key: 'ponto:tokens' } });
  return (row?.value as unknown as TokenSet) ?? null;
}
async function writeTokens(t: TokenSet) {
  await prisma.setting.upsert({
    where: { key: 'ponto:tokens' },
    create: { key: 'ponto:tokens', value: asJson(t) },
    update: { value: asJson(t) },
  });
}
export async function pontoDisconnect() {
  await prisma.setting.deleteMany({ where: { key: { in: ['ponto:tokens', 'ponto:oauth'] } } });
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  if (!pontoConfigured()) throw new Error('Ponto non configuré');
  const params = new URLSearchParams({ client_id: env.ponto.clientId, ...body }).toString();
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (env.ponto.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${env.ponto.clientId}:${env.ponto.clientSecret}`).toString('base64')}`;
  }
  const r = await httpsRequest(`${API_BASE}/oauth2/token`, { method: 'POST', headers, body: params });
  if (r.status >= 300) throw new Error(`Ponto token ${r.status} : ${r.text.slice(0, 300)}`);
  const j = JSON.parse(r.text) as { access_token: string; refresh_token?: string; expires_in: number };
  const set: TokenSet = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
  };
  await writeTokens(set);
  return set;
}

async function validToken(): Promise<string> {
  const cur = await readTokens();
  if (!cur) throw new Error('Ponto non connecté (aucun consentement)');
  if (cur.expiresAt > Date.now()) return cur.accessToken;
  if (!cur.refreshToken) throw new Error('Session Ponto expirée — reconnecter');
  const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refreshToken });
  return next.accessToken;
}

/* -------------------------------------------------------------- OAuth (PKCE) */

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function buildAuthUrl(): Promise<string> {
  if (!pontoConfigured()) throw new Error('Ponto non configuré');
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const oauth = asJson({ state, verifier, createdAt: Date.now() });
  await prisma.setting.upsert({
    where: { key: 'ponto:oauth' },
    create: { key: 'ponto:oauth', value: oauth },
    update: { value: oauth },
  });
  const q = new URLSearchParams({
    client_id: env.ponto.clientId,
    redirect_uri: env.ponto.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_BASE}/oauth2/auth?${q}`; // TODO(ibanity) confirmer le path exact
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: 'ponto:oauth' } });
  const saved = row?.value as { state: string; verifier: string; createdAt: number } | undefined;
  if (!saved || saved.state !== state) throw new Error('État OAuth invalide');
  if (Date.now() - saved.createdAt > 15 * 60_000) throw new Error('Lien de connexion expiré');
  await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.ponto.redirectUri,
    code_verifier: saved.verifier,
  });
  await prisma.setting.deleteMany({ where: { key: 'ponto:oauth' } });
}

/* ---------------------------------------------------------------- API calls */

async function apiGet<T = unknown>(pathname: string): Promise<T> {
  const token = await validToken();
  const url = pathname.startsWith('http') ? pathname : `${API_BASE}${pathname}`;
  const r = await httpsRequest(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (r.status >= 300) throw new Error(`Ponto GET ${pathname} -> ${r.status} : ${r.text.slice(0, 300)}`);
  return JSON.parse(r.text) as T;
}

async function apiPost<T = unknown>(pathname: string, body: unknown): Promise<T> {
  const token = await validToken();
  const r = await httpsRequest(`${API_BASE}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status >= 300) throw new Error(`Ponto POST ${pathname} -> ${r.status} : ${r.text.slice(0, 300)}`);
  return r.text ? (JSON.parse(r.text) as T) : ({} as T);
}

/* -------------------------------------------------------- comptes & transactions */

interface JsonApiItem<A> { id: string; attributes: A; relationships?: Record<string, unknown> }
interface JsonApiList<A> { data: JsonApiItem<A>[]; links?: { next?: string } }

type PontoAccountAttr = {
  reference?: string; // IBAN
  description?: string;
  currency?: string;
  availableBalance?: number;
  currentBalance?: number;
  subtype?: string;
};
type PontoTxAttr = {
  amount?: number;
  currency?: string;
  counterpartName?: string;
  counterpartReference?: string;
  description?: string;
  remittanceInformation?: string;
  remittanceInformationType?: string; // "structured" | "unstructured"
  executionDate?: string;
  valueDate?: string;
};

export interface NormalizedTx {
  externalId: string;
  bookingDate: Date | null;
  valueDate: Date | null;
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  description: string | null;
  communication: string | null;
  structuredComm: string | null;
  side: 'in' | 'out';
}

/** Normalise « structuré » : ne garde que les chiffres (12 pour une comm BE). */
export function normalizeStructuredComm(raw: string | null | undefined, type?: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (type === 'structured' && digits.length === 12) return digits;
  // détecte aussi le format +++xxx/xxxx/xxxxx+++ dans un texte libre
  const m = raw.match(/(\d{3})[/ ]?(\d{4})[/ ]?(\d{5})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return null;
}

export function normalizePontoTx(item: JsonApiItem<PontoTxAttr>): NormalizedTx {
  const a = item.attributes;
  const amount = Number(a.amount ?? 0);
  const comm = a.remittanceInformation ?? null;
  return {
    externalId: item.id,
    bookingDate: a.executionDate ? new Date(a.executionDate) : null,
    valueDate: a.valueDate ? new Date(a.valueDate) : null,
    amount,
    currency: a.currency ?? 'EUR',
    counterpartyName: a.counterpartName ?? null,
    counterpartyAccount: a.counterpartReference ?? null,
    description: a.description ?? null,
    communication: comm,
    structuredComm: normalizeStructuredComm(comm, a.remittanceInformationType),
    side: amount < 0 ? 'out' : 'in',
  };
}

/** Rafraîchit la liste des comptes (upsert BankAccount). */
export async function refreshAccounts(): Promise<number> {
  const list = await apiGet<JsonApiList<PontoAccountAttr>>('/accounts?page[limit]=100');
  for (const it of list.data) {
    await prisma.bankAccount.upsert({
      where: { externalId: it.id },
      create: {
        externalId: it.id,
        iban: it.attributes.reference ?? null,
        label: it.attributes.description ?? it.attributes.reference ?? null,
        currency: it.attributes.currency ?? 'EUR',
        balance: it.attributes.currentBalance ?? it.attributes.availableBalance ?? null,
        balanceAt: new Date(),
      },
      update: {
        iban: it.attributes.reference ?? undefined,
        label: it.attributes.description ?? undefined,
        balance: it.attributes.currentBalance ?? it.attributes.availableBalance ?? undefined,
        balanceAt: new Date(),
      },
    });
  }
  return list.data.length;
}

async function triggerSync(accountId: string): Promise<void> {
  try {
    await apiPost('/synchronizations', {
      data: { type: 'synchronization', attributes: { resourceType: 'account', resourceId: accountId, subtype: 'accountTransactions' } },
    });
  } catch (e) {
    // pas bloquant : on lira quand même les transactions déjà côté Ponto
    console.warn('[ponto] synchronization non déclenchée :', (e as Error).message);
  }
}

/** Récupère les nouvelles transactions d'un compte (pagination + curseur incrémental). */
export async function fetchAccountTransactions(account: { id: string; externalId: string; syncCursor: string | null }): Promise<NormalizedTx[]> {
  await triggerSync(account.externalId);
  const out: NormalizedTx[] = [];
  let url: string | undefined = account.syncCursor
    ? `${API_BASE}/accounts/${account.externalId}/transactions?page[limit]=100&page[after]=${account.syncCursor}`
    : `/accounts/${account.externalId}/transactions?page[limit]=100`;
  let lastId: string | null = account.syncCursor;
  let guard = 0;
  while (url && guard++ < 50) {
    const page: JsonApiList<PontoTxAttr> = await apiGet<JsonApiList<PontoTxAttr>>(url);
    for (const it of page.data) { out.push(normalizePontoTx(it)); lastId = it.id; }
    url = page.links?.next;
  }
  if (lastId && lastId !== account.syncCursor) {
    await prisma.bankAccount.update({ where: { id: account.id }, data: { syncCursor: lastId, lastSyncAt: new Date() } });
  } else {
    await prisma.bankAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date() } });
  }
  return out;
}
