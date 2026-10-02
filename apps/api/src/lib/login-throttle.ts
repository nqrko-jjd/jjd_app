import { HttpError } from './http.js';

/** Limite les essais de connexion (un code à 6 chiffres se devinerait sinon). En mémoire : un seul
 *  processus API, et un redémarrage remet les compteurs à zéro — acceptable pour ce rôle. */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_ACCOUNT = 8;
const MAX_PER_IP = 100;
const fails = new Map<string, number[]>();

function recent(key: string): number[] {
  const now = Date.now();
  const a = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (a.length) fails.set(key, a); else fails.delete(key);
  return a;
}

export function assertLoginAllowed(account: string, ip: string) {
  if (recent(`a:${account}`).length >= MAX_PER_ACCOUNT || recent(`i:${ip}`).length >= MAX_PER_IP) {
    throw new HttpError(429, 'Trop d’essais. Réessaie dans 15 minutes.');
  }
}

export function recordLoginFailure(account: string, ip: string) {
  for (const key of [`a:${account}`, `i:${ip}`]) fails.set(key, [...recent(key), Date.now()]);
  if (fails.size > 5000) for (const key of [...fails.keys()]) recent(key);
}

export function clearLoginFailures(account: string) {
  fails.delete(`a:${account}`);
}
